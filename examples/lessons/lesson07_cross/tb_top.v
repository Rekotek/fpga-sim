// Тестбенч урока 7: перекрёсток. Две проверки:
// 1) таблица: состояние в каждую «секунду» полного круга;
// 2) правило безопасности на КАЖДОМ такте: хотя бы одна дорога видит красный.
`timescale 1ns / 100ps

module tb_top;
    localparam integer N = 18;        // секунд в таблице (полный круг 16 с + 2)

    reg        clk = 1'b0;
    reg        btn = 1'b0;
    wire [5:0] led;

    always #18.5 clk = ~clk;

    // CLK_HZ = 20: «секунда» = 20 тактов.
    top #(.CLK_HZ(20)) dut (.clk(clk), .btn_s2(btn), .led(led));

    wire [2:0] a = ~led[2:0];         // дорога A: {зелёный, жёлтый, красный}
    wire [2:0] b = ~led[5:3];         // дорога B

    reg [3:0] want [0:N-1];
    integer   t, errors = 0, danger = 0, clocks = 0;

    // Правило безопасности: проверяем на каждом такте, пока идёт тест.
    always @(negedge clk) begin
        clocks = clocks + 1;
        if (!a[0] && !b[0]) begin                    // ни у кого нет красного
            danger = danger + 1;
            if (danger == 1)
                $display("ОПАСНО: %0d нс, A = %b, B = %b", $time, a, b);
        end
    end

    initial begin
        // Полный круг: 8 — все красные, 9 — A кр+жёл, 0 — A едет, 1 — A мигает,
        // 2 — A жёлтый, 3 — все красные, 4 — B кр+жёл, 5 — B едет, 6 — B мигает, 7 — B жёлтый.
        want[0]  = 8; want[1]  = 9; want[2]  = 0; want[3]  = 0; want[4]  = 0;
        want[5]  = 1; want[6]  = 1; want[7]  = 2; want[8]  = 3; want[9]  = 4;
        want[10] = 5; want[11] = 5; want[12] = 5; want[13] = 6; want[14] = 6;
        want[15] = 7; want[16] = 8; want[17] = 9;

        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        $display("секунда  state  A: К Ж З   B: К Ж З   ожидали");

        @(negedge clk);
        for (t = 0; t < N; t = t + 1) begin
            if (t > 0) begin
                @(posedge dut.sec_tick);
                @(posedge clk);
                @(negedge clk);
            end
            $display("  %2d      %2d       %b %b %b      %b %b %b      %0d",
                     t, dut.state, a[0], a[1], a[2], b[0], b[1], b[2], want[t]);
            if (dut.state !== want[t]) errors = errors + 1;
        end

        $display("проверено тактов: %0d, опасных: %0d", clocks, danger);
        if (errors == 0 && danger == 0) $display("ТЕСТ ПРОЙДЕН");
        else $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d, опасных тактов %0d", errors, danger);
        $finish;
    end
endmodule
