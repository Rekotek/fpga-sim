// Тестбенч урока 7: кодовый замок. Таблица: какую кнопку нажать и в каком
// состоянии должен оказаться автомат. Кнопки дребезжат, как в уроке 6.
`timescale 1ns / 100ps

module tb_top;
    localparam integer BOUNCE = 3;    // сколько раз контакт дребезжит
    localparam integer N      = 12;   // строк в таблице

    reg        clk = 1'b0;
    reg  [1:0] btn = 2'b00;           // btn[0] = S1, btn[1] = S2
    wire [5:0] led;

    always #18.5 clk = ~clk;          // период 37 нс, как 27 МГц

    // CLK_HZ = 1000: один такт = «1 мс», антидребезг опрашивает раз в 10 тактов.
    top #(.CLK_HZ(1000)) dut (.clk(clk), .btn_s1(btn[0]), .btn_s2(btn[1]), .led(led));

    wire [5:0] on = ~led;             // 1 = горит

    // Таблица ожиданий: кнопка (1 = S1, 2 = S2) и состояние после нажатия.
    integer key  [1:N];
    integer want [1:N];
    integer n, errors = 0;

    // Перевести кнопку i в положение v (1 = нажата) с дребезгом и подождать.
    task move (input integer i, input v);
        integer k;
        begin
            for (k = 0; k < BOUNCE; k = k + 1) begin
                btn[i] = v;   #60;
                btn[i] = ~v;  #40;
            end
            btn[i] = v;  #1500;
        end
    endtask

    // Нажать и отпустить кнопку: 1 = S1, 2 = S2.
    task press (input integer b);
        begin
            move(b - 1, 1'b1);
            move(b - 1, 1'b0);
        end
    endtask

    initial begin
        // Код S1 S2 S2 S1. Сначала верно, потом закрыть, потом ошибки.
        key[1]  = 1; want[1]  = 1;   // S1          → S_1
        key[2]  = 2; want[2]  = 2;   // S1 S2       → S_12
        key[3]  = 2; want[3]  = 3;   // S1 S2 S2    → S_122
        key[4]  = 1; want[4]  = 4;   // код верный  → S_OPEN
        key[5]  = 2; want[5]  = 0;   // открыто, любое нажатие → S_0
        key[6]  = 2; want[6]  = 0;   // S2 первой — неверно, остаёмся в S_0
        key[7]  = 1; want[7]  = 1;   // S1          → S_1
        key[8]  = 1; want[8]  = 0;   // S1 S1 — неверно → S_0
        key[9]  = 1; want[9]  = 1;   // заново: S1  → S_1
        key[10] = 2; want[10] = 2;   // S1 S2       → S_12
        key[11] = 1; want[11] = 0;   // S1 S2 S1 — неверно → S_0
        key[12] = 2; want[12] = 0;   // S2 — неверно, остаёмся в S_0

        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        $display("шаг  кнопка  state  LED5..0  ожидали");

        #100;
        for (n = 1; n <= N; n = n + 1) begin
            press(key[n]);
            $display("%2d     S%0d      %0d    %b     %0d",
                     n, key[n], dut.state, on, want[n]);
            if (dut.state !== want[n]) errors = errors + 1;
        end

        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
