// Тестбенч урока 7: светофор. Каждую «секунду» сверяем состояние с таблицей
// и смотрим на лампы дважды: в начале секунды и в её середине (мигание!).
// Потом жмём S2 посреди зелёного и проверяем, что светофор начал с красного.
`timescale 1ns / 100ps

module tb_top;
    reg        clk = 1'b0;
    reg        btn = 1'b0;            // кнопка S2 в руках тестбенча
    wire [5:0] led;

    always #18.5 clk = ~clk;          // период 37 нс, как 27 МГц

    // CLK_HZ = 20: «секунда» = 20 тактов, «полсекунды» = 10 тактов.
    top #(.CLK_HZ(20)) dut (.clk(clk), .btn_s2(btn), .led(led));

    wire [2:0] on = ~led[2:0];        // {зелёный, жёлтый, красный}, 1 = горит

    // Таблица ожиданий: состояние в каждую из первых 12 секунд.
    // 0 — красный, 1 — красный+жёлтый, 2 — зелёный, 3 — зелёный мигает, 4 — жёлтый.
    reg [2:0] want [0:11];
    reg [2:0] first;                  // лампы в начале секунды
    integer   t, errors = 0;

    // Сверить состояние, посмотреть лампы в начале и в середине секунды.
    task check (input integer sec, input [2:0] w);
        begin
            first = on;
            repeat (10) @(negedge clk);           // через «полсекунды»
            $display("    %2d      %0d    %b %b %b    %b %b %b         %0d",
                     sec, dut.state, first[0], first[1], first[2],
                     on[0], on[1], on[2], w);
            if (dut.state !== w) errors = errors + 1;
            // Мигание: в состоянии 3 зелёный горит в начале и гаснет в середине,
            // в остальных состояниях лампы за секунду не меняются.
            if (w == 3 && !(first == 3'b100 && on == 3'b000)) errors = errors + 1;
            if (w != 3 && first !== on)                       errors = errors + 1;
        end
    endtask

    // Таймаут: если автомат завис и wait никогда не дождётся, тест всё равно закончится.
    initial begin
        #50_000;
        $display("ТЕСТ НЕ ПРОЙДЕН: время вышло");
        $finish;
    end

    initial begin
        want[0] = 0; want[1] = 0; want[2]  = 0; want[3]  = 1;
        want[4] = 2; want[5] = 2; want[6]  = 2; want[7]  = 3;
        want[8] = 3; want[9] = 4; want[10] = 0; want[11] = 0;

        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        $display("        секунда  state  начало   середина  ожидали");
        $display("                          К Ж З    К Ж З");

        @(negedge clk);
        $write("ход      ");  check(0, want[0]);
        for (t = 1; t <= 11; t = t + 1) begin
            @(posedge dut.sec_tick);          // тик пришёл...
            @(posedge clk);                   // ...на этом фронте автомат шагнул
            @(negedge clk);                   // смотрим между фронтами
            $write("ход      ");  check(t, want[t]);
        end

        // Сброс посреди фазы: ждём зелёного, держим S2 600 нс (меньше «секунды» = 740 нс).
        wait (dut.state == 2);
        #300  btn = 1'b1;
        #600  btn = 1'b0;
        $write("S2 нажали");  check(0, 0);
        // После сброса красный снова горит ровно 3 секунды.
        for (t = 1; t <= 4; t = t + 1) begin
            @(posedge dut.sec_tick);
            @(posedge clk);
            @(negedge clk);
            $write("после S2 ");  check(t, want[t]);
        end

        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
